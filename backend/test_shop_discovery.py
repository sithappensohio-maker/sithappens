"""Discovery, favourites and receipts — what a customer may be shown.

Three features share this file because they share one failure mode. Each of
them takes a reference a browser supplied, and each of them turns that
reference into something on a screen. That is exactly the shape of request
that leaks a hidden product: not by breaking in, but by asking politely for
something by id and being answered.

So most of what follows is one question asked in several accents:

    can a caller make an item appear that they could not already see?

by crafting a recommendation, by favouriting it, by putting it in a
recently-viewed list, by finding it on somebody else's receipt. The answer
has to be no every time, and it has to be no because of how the code is
SHAPED — everything resolves through the caller's own catalogue — not
because each route remembered to check.

The rest is about money after the money moved: that "Buy Again" reconstructs
what someone meant to buy and never what it cost them.
"""
import contextlib
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run
from fastapi import HTTPException

from domains.shop import discovery_routes
from domains.shop import favorites as favorites_mod
from domains.shop import orders as shop_orders_view
from domains.shop import recommendations as rec_mod
from domains.shop import relationships as rel_mod

TAG = "TEST_SHOP_DISCOVERY"


# ─────────────────────────────────────────────────────────────── harness

class _Req:
    def __init__(self, ip=None):
        ip = ip or f"198.19.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250}"
        self.client = type("C", (), {"host": ip})()
        self.headers = {}
        self.url = type("U", (), {"path": "/api/shop/x"})()


def _admin():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin"}


@contextlib.contextmanager
def _client(**kw):
    cid = str(uuid.uuid4())
    doc = dict(id=cid, name=f"{TAG} Client", email=f"{cid[:8]}@example.com",
               created_at=server.now_iso())
    doc.update(kw)
    run(server.db.clients.insert_one(doc))
    try:
        yield {"role": "client", "client_id": cid, "id": str(uuid.uuid4())}
    finally:
        run(server.db.clients.delete_one({"id": cid}))
        run(server.db.shop_favorites.delete_many({"client_id": cid}))
        run(server.db.shop_orders.delete_many({"client_id": cid}))


@contextlib.contextmanager
def _dog(client_user, **kw):
    did = str(uuid.uuid4())
    doc = dict(id=did, name=f"{TAG} Dog", owner_id=client_user["client_id"],
               created_at=server.now_iso())
    doc.update(kw)
    run(server.db.dogs.insert_one(doc))
    try:
        yield doc
    finally:
        run(server.db.dogs.delete_one({"id": did}))
        run(server.db.dog_programs.delete_many({"dog_id": did}))
        run(server.db.school_enrollments.delete_many({"dog_id": did}))


@contextlib.contextmanager
def _product(**kw):
    defaults = dict(name=f"{TAG} Product {uuid.uuid4().hex[:6]}", price=19.99,
                    show_online=True, active=True, starting_stock=5,
                    track_inventory=True, publicly_visible=True)
    defaults.update(kw)
    created = run(server.create_pos_product(server.PosProductCreateIn(**defaults), _admin()))
    try:
        yield created
    finally:
        run(server.db.pos_products.delete_one({"id": created["id"]}))


@contextlib.contextmanager
def _program(**kw):
    defaults = dict(name=f"{TAG} Program {uuid.uuid4().hex[:6]}", type="private_lessons",
                    available_online=True, active=True, price=250.0)
    defaults.update(kw)
    # An Online School course must be authored as self-guided; the server
    # refuses the combination at creation time, not at purchase time.
    if defaults.get("purchase_fulfillment") == "online_school":
        defaults.setdefault("delivery_mode", "self_guided")
    created = run(server.create_program(server.ProgramIn(**defaults), _admin()))
    try:
        yield created
    finally:
        run(server.db.programs.delete_one({"id": created["id"]}))


def _relate(product_id, targets):
    """Curate relationships the way the admin editor does — through the real
    update endpoint, so the validation under test is the validation that
    runs in production."""
    existing = run(server.db.pos_products.find_one({"id": product_id}, {"_id": 0}))
    body = server.PosProductIn(
        name=existing["name"], price=existing.get("price") or 0,
        show_online=bool(existing.get("show_online")),
        active=bool(existing.get("active")),
        track_inventory=bool(existing.get("track_inventory")),
        publicly_visible=existing.get("publicly_visible"),
        shop_relationships=targets)
    return run(server.update_pos_product(product_id, body, _admin()))


def _discovery(user, **body):
    body.setdefault("recent", [])
    return run(discovery_routes.DiscoveryIn(**body)), user


def _ask(user, **body):
    fn = _endpoint("shop_discovery")
    return run(fn(discovery_routes.DiscoveryIn(**body), _Req(), user))


@contextlib.contextmanager
def _public_shop_open(**overrides):
    """The public storefront switched on, restored afterwards."""
    settings = run(server.get_settings())
    before = (settings.get("shop_page") or {}).copy()
    sp = before.copy()
    sp.update({"public_shop_enabled": True, "public_browsing_enabled": True,
               "show_public_prices": True, "show_public_merch": True,
               "show_public_training": True})
    sp.update(overrides)
    run(server.db.settings.update_one({}, {"$set": {"shop_page": sp}}, upsert=True))
    try:
        yield sp
    finally:
        run(server.db.settings.update_one({}, {"$set": {"shop_page": before}}, upsert=True))


def _ask_public(**body):
    fn = _endpoint("public_shop_discovery")
    with _public_shop_open():
        return run(fn(discovery_routes.DiscoveryIn(**body), _Req()))


def _endpoint(name):
    for r in server.app.routes:
        if getattr(r, "endpoint", None) is not None and r.endpoint.__name__ == name:
            return r.endpoint
    raise AssertionError(f"route {name} is not registered")


def _names(result):
    return sorted(r["item"]["name"] for r in result["recommendations"])


# ────────────────────────────────────────────────── curated relationships

def test_a_curated_relationship_is_what_shows_up():
    with _client() as user, _product() as leash, _product() as harness:
        _relate(leash["id"], [{"rel": "complements", "kind": "product", "ref_id": harness["id"]}])
        out = _ask(user, kind="product", ref_id=leash["id"])
        assert harness["name"] in _names(out)
        assert out["recommendations"][0]["rel"] == "complements"
        assert out["recommendations"][0]["label"] == "Pairs well with"


def test_curated_order_is_the_order_the_admin_chose():
    # Not alphabetical, not by price, not by id. The person curating decided.
    with _client() as user, _product() as base, \
            _product(name=f"{TAG} Zebra") as z, _product(name=f"{TAG} Apple") as a:
        _relate(base["id"], [
            {"rel": "complements", "kind": "product", "ref_id": z["id"]},
            {"rel": "complements", "kind": "product", "ref_id": a["id"]},
        ])
        out = _ask(user, kind="product", ref_id=base["id"], limit=2)
        assert [r["item"]["name"] for r in out["recommendations"]] == [z["name"], a["name"]]


def test_complements_come_before_related():
    with _client() as user, _product() as base, _product() as c, _product() as r:
        _relate(base["id"], [
            {"rel": "related", "kind": "product", "ref_id": r["id"]},
            {"rel": "complements", "kind": "product", "ref_id": c["id"]},
        ])
        out = _ask(user, kind="product", ref_id=base["id"], limit=2)
        assert [x["rel"] for x in out["recommendations"]] == ["complements", "related"]


def test_an_item_cannot_be_related_to_itself():
    with _product() as p:
        try:
            _relate(p["id"], [{"rel": "related", "kind": "product", "ref_id": p["id"]}])
            raise AssertionError("a self-reference was accepted")
        except HTTPException as e:
            assert e.status_code == 422
            assert "itself" in e.detail


def test_the_same_relationship_cannot_be_added_twice():
    with _product() as base, _product() as other:
        try:
            _relate(base["id"], [
                {"rel": "related", "kind": "product", "ref_id": other["id"]},
                {"rel": "related", "kind": "product", "ref_id": other["id"]},
            ])
            raise AssertionError("a duplicate relationship was accepted")
        except HTTPException as e:
            assert e.status_code == 422


def test_the_same_item_may_be_both_a_complement_and_an_alternate():
    # Different claims about the same product are not duplicates.
    with _product() as base, _product() as other:
        saved = _relate(base["id"], [
            {"rel": "complements", "kind": "product", "ref_id": other["id"]},
            {"rel": "alternate", "kind": "product", "ref_id": other["id"]},
        ])
        assert len(saved["shop_relationships"]) == 2


def test_omitting_relationships_keeps_them_rather_than_erasing_them():
    # A save from anything that predates this field must not wipe an
    # admin's curation as a side effect.
    with _product() as base, _product() as other:
        _relate(base["id"], [{"rel": "related", "kind": "product", "ref_id": other["id"]}])
        run(server.update_pos_product(
            base["id"],
            server.PosProductIn(name=base["name"], price=base.get("price") or 0),
            _admin()))
        after = run(server.db.pos_products.find_one({"id": base["id"]}, {"_id": 0}))
        assert len(after.get("shop_relationships") or []) == 1


def test_an_explicit_empty_list_does_clear_them():
    with _product() as base, _product() as other:
        _relate(base["id"], [{"rel": "related", "kind": "product", "ref_id": other["id"]}])
        _relate(base["id"], [])
        after = run(server.db.pos_products.find_one({"id": base["id"]}, {"_id": 0}))
        assert after.get("shop_relationships") == []


def test_a_reference_to_something_deleted_is_simply_one_fewer_card():
    with _client() as user, _product() as base:
        gone = str(uuid.uuid4())
        run(server.db.pos_products.update_one(
            {"id": base["id"]},
            {"$set": {"shop_relationships": [
                {"rel": "related", "kind": "product", "ref_id": gone, "position": 0}]}}))
        out = _ask(user, kind="product", ref_id=base["id"])
        assert all(r["item"]["id"] != gone for r in out["recommendations"])


def test_a_malformed_stored_relationship_does_not_break_the_page():
    # Reading is not saving: a row written by hand or by an old import can
    # hold anything, and the page still has to render.
    with _client() as user, _product() as base, _product() as ok:
        run(server.db.pos_products.update_one(
            {"id": base["id"]},
            {"$set": {"shop_relationships": [
                "nonsense", 42, {"rel": "made_up", "kind": "product", "ref_id": "x"},
                {"rel": "related", "kind": "product", "ref_id": ok["id"], "position": 1},
            ]}}))
        out = _ask(user, kind="product", ref_id=base["id"])
        assert ok["name"] in _names(out)


# ──────────────────────────────────────────── what must never be recommended

def test_an_inactive_product_never_surfaces_as_a_recommendation():
    with _client() as user, _product() as base, _product() as hidden:
        _relate(base["id"], [{"rel": "related", "kind": "product", "ref_id": hidden["id"]}])
        run(server.db.pos_products.update_one({"id": hidden["id"]}, {"$set": {"active": False}}))
        out = _ask(user, kind="product", ref_id=base["id"])
        assert hidden["name"] not in _names(out)


def test_an_offline_product_never_surfaces_as_a_recommendation():
    with _client() as user, _product() as base, _product() as hidden:
        _relate(base["id"], [{"rel": "related", "kind": "product", "ref_id": hidden["id"]}])
        run(server.db.pos_products.update_one({"id": hidden["id"]}, {"$set": {"show_online": False}}))
        out = _ask(user, kind="product", ref_id=base["id"])
        assert hidden["name"] not in _names(out)


def test_an_account_only_product_is_not_recommended_to_a_guest():
    with _product(publicly_visible=True) as base, _product(publicly_visible=False) as private:
        _relate(base["id"], [{"rel": "related", "kind": "product", "ref_id": private["id"]}])
        out = _ask_public(kind="product", ref_id=base["id"])
        assert private["name"] not in _names(out)


def test_shopify_merchandise_is_not_recommended_into_our_own_cart():
    with _client() as user, _product() as base, \
            _product(sales_destination="shopify_external",
                     shopify_product_url="https://example.com/x",
                     shopify_display_price=10.0) as shopify:
        _relate(base["id"], [{"rel": "related", "kind": "product", "ref_id": shopify["id"]}])
        out = _ask(user, kind="product", ref_id=base["id"])
        assert shopify["name"] not in _names(out)


def test_a_product_never_recommends_itself():
    with _client() as user, _product() as base:
        out = _ask(user, kind="product", ref_id=base["id"], limit=8)
        assert all(r["item"]["id"] != base["id"] for r in out["recommendations"])


# ─────────────────────────────────────────── training needs more care

def test_a_course_the_dog_is_already_enrolled_in_is_not_recommended():
    with _client() as user, _dog(user) as dog, _product() as base, \
            _program(purchase_fulfillment="online_school", requires_dog=True,
                     format={"count": 8, "unit": "lessons"}) as course:
        _relate(base["id"], [{"rel": "related", "kind": "training_program", "ref_id": course["id"]}])
        # Before enrolling, it is a perfectly good suggestion.
        assert course["name"] in _names(_ask(user, kind="product", ref_id=base["id"]))
        run(server.db.dog_programs.insert_one({
            "id": str(uuid.uuid4()), "dog_id": dog["id"], "program_id": course["id"],
            "delivery_channel": "online_school", "status": "active",
            "created_at": server.now_iso()}))
        assert course["name"] not in _names(_ask(user, kind="product", ref_id=base["id"]))


def test_a_completed_course_is_not_recommended_again():
    with _client() as user, _dog(user) as dog, _product() as base, \
            _program(purchase_fulfillment="online_school", requires_dog=True,
                     format={"count": 8, "unit": "lessons"}) as course:
        _relate(base["id"], [{"rel": "related", "kind": "training_program", "ref_id": course["id"]}])
        run(server.db.dog_programs.insert_one({
            "id": str(uuid.uuid4()), "dog_id": dog["id"], "program_id": course["id"],
            "delivery_channel": "online_school", "status": "completed",
            "created_at": server.now_iso()}))
        assert course["name"] not in _names(_ask(user, kind="product", ref_id=base["id"]))


def test_a_second_dog_who_has_not_taken_it_keeps_the_recommendation():
    # Per dog, not per household: one dog finishing a course must not hide
    # it from the other dog who never took it.
    with _client() as user, _dog(user) as dog_a, _dog(user) as dog_b, _product() as base, \
            _program(purchase_fulfillment="online_school", requires_dog=True,
                     format={"count": 8, "unit": "lessons"}) as course:
        _relate(base["id"], [{"rel": "related", "kind": "training_program", "ref_id": course["id"]}])
        run(server.db.dog_programs.insert_one({
            "id": str(uuid.uuid4()), "dog_id": dog_a["id"], "program_id": course["id"],
            "delivery_channel": "online_school", "status": "active",
            "created_at": server.now_iso()}))
        assert course["name"] in _names(_ask(user, kind="product", ref_id=base["id"]))
        assert dog_b["id"]  # the reason it is still there


def test_a_client_with_no_dogs_is_not_offered_a_course_that_needs_one():
    with _client() as user, _product() as base, \
            _program(purchase_fulfillment="online_school", requires_dog=True,
                     format={"count": 8, "unit": "lessons"}) as course:
        _relate(base["id"], [{"rel": "related", "kind": "training_program", "ref_id": course["id"]}])
        assert course["name"] not in _names(_ask(user, kind="product", ref_id=base["id"]))


def test_a_guest_is_never_offered_dog_required_training():
    # Eligibility cannot be established without an account, and the rule for
    # unknown eligibility is to omit rather than guess.
    with _product() as base, _program(purchase_fulfillment="online_school", requires_dog=True,
                                      publicly_visible=True, show_public_price=True,
                                      format={"count": 8, "unit": "lessons"}) as course:
        _relate(base["id"], [{"rel": "related", "kind": "training_program", "ref_id": course["id"]}])
        assert course["name"] not in _names(_ask_public(kind="product", ref_id=base["id"]))


def test_a_dog_required_program_with_no_online_path_is_not_offered():
    # requires_dog without Online School fulfilment cannot be bought through
    # the cart at all, so offering it would be an offer nobody can accept.
    with _client() as user, _dog(user), _product() as base, \
            _program(requires_dog=True) as course:
        _relate(base["id"], [{"rel": "related", "kind": "training_program", "ref_id": course["id"]}])
        assert course["name"] not in _names(_ask(user, kind="product", ref_id=base["id"]))


# ────────────────────────────────────────────────── the same-department fallback

def test_the_fallback_only_tops_up_a_short_row():
    # Three products, one of them curated. The other two are what the
    # fallback has to find — without them the row is one card long and the
    # assertion below cannot tell a working fallback from a missing one.
    with _client() as user, _product() as base, _product() as curated,             _product() as spare_a, _product() as spare_b:
        assert spare_a["id"] and spare_b["id"]
        _relate(base["id"], [{"rel": "complements", "kind": "product", "ref_id": curated["id"]}])
        out = _ask(user, kind="product", ref_id=base["id"], limit=4)
        rels = [r["rel"] for r in out["recommendations"]]
        assert rels[0] == "complements"
        # `all()` over an empty tail is true, so without this the test passed
        # just as happily when the fallback was switched off entirely.
        assert len(rels) > 1, "the one curated item was not topped up"
        assert all(r == "same_department" for r in rels[1:])


def test_a_fully_curated_row_uses_no_fallback_at_all():
    with _client() as user, _product() as base, _product() as a, _product() as b:
        _relate(base["id"], [
            {"rel": "complements", "kind": "product", "ref_id": a["id"]},
            {"rel": "complements", "kind": "product", "ref_id": b["id"]},
        ])
        out = _ask(user, kind="product", ref_id=base["id"], limit=2)
        assert [r["rel"] for r in out["recommendations"]] == ["complements", "complements"]


def test_the_row_is_capped():
    with _client() as user, _product() as base:
        out = _ask(user, kind="product", ref_id=base["id"], limit=3)
        assert len(out["recommendations"]) <= 3


# ────────────────────────────────────────────────────────── recently viewed

def test_recently_viewed_references_resolve_to_real_items():
    with _client() as user, _product() as a, _product() as b:
        out = _ask(user, recent=[{"kind": "product", "ref_id": a["id"]},
                                 {"kind": "product", "ref_id": b["id"]}])
        assert [i["id"] for i in out["recently_viewed"]] == [a["id"], b["id"]]


def test_a_hidden_product_in_a_recently_viewed_list_simply_vanishes():
    with _client() as user, _product() as a, _product() as hidden:
        run(server.db.pos_products.update_one({"id": hidden["id"]}, {"$set": {"active": False}}))
        out = _ask(user, recent=[{"kind": "product", "ref_id": hidden["id"]},
                                 {"kind": "product", "ref_id": a["id"]}])
        assert [i["id"] for i in out["recently_viewed"]] == [a["id"]]


def test_an_account_only_product_cannot_be_surfaced_by_a_guest_recent_list():
    with _product(publicly_visible=False) as private:
        out = _ask_public(recent=[{"kind": "product", "ref_id": private["id"]}])
        assert out["recently_viewed"] == []


def test_the_item_being_viewed_is_not_listed_as_recently_viewed():
    with _client() as user, _product() as a:
        out = _ask(user, kind="product", ref_id=a["id"],
                   recent=[{"kind": "product", "ref_id": a["id"]}])
        assert out["recently_viewed"] == []


def test_a_repeated_reference_resolves_once():
    with _client() as user, _product() as a:
        out = _ask(user, recent=[{"kind": "product", "ref_id": a["id"]},
                                 {"kind": "product", "ref_id": a["id"]}])
        assert len(out["recently_viewed"]) == 1


def test_a_client_session_is_required_for_the_private_discovery_route():
    fn = _endpoint("shop_discovery")
    for bad in ({"role": "admin"}, {"role": "client"}):  # admin, and a client with no account
        try:
            run(fn(discovery_routes.DiscoveryIn(), _Req(), bad))
            raise AssertionError("discovery answered a caller with no client account")
        except HTTPException as e:
            assert e.status_code == 403


# ──────────────────────────────────────────────────────────── favourites

def _fav_add(user, kind, ref_id):
    return run(_endpoint("add_shop_favorite")(
        discovery_routes.FavoriteIn(kind=kind, ref_id=ref_id), _Req(), user))


def _fav_remove(user, kind, ref_id):
    return run(_endpoint("remove_shop_favorite")(kind, ref_id, _Req(), user))


def _fav_list(user):
    return run(_endpoint("list_shop_favorites")(_Req(), user))["favorites"]


def test_a_favourite_is_saved_and_comes_back():
    with _client() as user, _product() as p:
        _fav_add(user, "product", p["id"])
        saved = _fav_list(user)
        assert [f["ref_id"] for f in saved] == [p["id"]]
        assert saved[0]["available"] is True
        assert saved[0]["item"]["name"] == p["name"]


def test_saving_the_same_thing_twice_saves_it_once():
    with _client() as user, _product() as p:
        _fav_add(user, "product", p["id"])
        _fav_add(user, "product", p["id"])
        assert len(_fav_list(user)) == 1


def test_removing_a_favourite_removes_it():
    with _client() as user, _product() as p:
        _fav_add(user, "product", p["id"])
        _fav_remove(user, "product", p["id"])
        assert _fav_list(user) == []


def test_removing_something_that_was_never_saved_succeeds():
    # The second click of a button already doing what was asked is not an error.
    with _client() as user, _product() as p:
        assert _fav_remove(user, "product", p["id"])["removed"] == 0


def test_a_hidden_product_cannot_be_favourited():
    with _client() as user, _product() as p:
        run(server.db.pos_products.update_one({"id": p["id"]}, {"$set": {"show_online": False}}))
        try:
            _fav_add(user, "product", p["id"])
            raise AssertionError("a hidden product was favourited")
        except HTTPException as e:
            assert e.status_code == 404


def test_an_item_that_never_existed_cannot_be_favourited():
    with _client() as user:
        try:
            _fav_add(user, "product", str(uuid.uuid4()))
            raise AssertionError("a nonexistent product was favourited")
        except HTTPException as e:
            # The SAME 404 a hidden product gets, so the response cannot be
            # used to find out which ids exist.
            assert e.status_code == 404
            assert e.detail == "This item is unavailable."


def test_a_gift_card_cannot_be_favourited():
    with _client() as user:
        try:
            _fav_add(user, "gift_card", "gc-2500")
            raise AssertionError("a gift card was favourited")
        except HTTPException as e:
            assert e.status_code == 404


def test_one_client_cannot_see_anothers_favourites():
    with _client() as mine, _client() as theirs, _product() as p:
        _fav_add(theirs, "product", p["id"])
        assert _fav_list(mine) == []


def test_one_client_cannot_delete_anothers_favourite():
    with _client() as mine, _client() as theirs, _product() as p:
        _fav_add(theirs, "product", p["id"])
        result = _fav_remove(mine, "product", p["id"])
        assert result["removed"] == 0
        assert len(_fav_list(theirs)) == 1


def test_a_favourite_that_became_unavailable_stays_visible_but_says_nothing_about_it():
    # Understandable, and leaking nothing: they know something they saved is
    # gone and can remove it, and no name of a hidden product came back.
    with _client() as user, _product() as p:
        _fav_add(user, "product", p["id"])
        run(server.db.pos_products.update_one({"id": p["id"]}, {"$set": {"show_online": False}}))
        saved = _fav_list(user)
        assert len(saved) == 1
        assert saved[0]["available"] is False
        assert saved[0]["item"] is None
        assert p["name"] not in str(saved)


def test_favourites_are_newest_first():
    with _client() as user, _product() as a, _product() as b:
        _fav_add(user, "product", a["id"])
        _fav_add(user, "product", b["id"])
        assert [f["ref_id"] for f in _fav_list(user)][0] == b["id"]


def test_a_client_session_is_required_to_read_favourites():
    try:
        run(_endpoint("list_shop_favorites")(_Req(), {"role": "admin"}))
        raise AssertionError("favourites answered an admin session")
    except HTTPException as e:
        assert e.status_code == 403


# ──────────────────────────────────────────────────────────── the receipt

def _order(client_id, lines, **kw):
    doc = dict(id=str(uuid.uuid4()), client_id=client_id, status="paid",
               fulfillment_status="fulfilled", pickup_status=None,
               subtotal=10.0, tax_amount=0.75, total=10.75, currency="USD",
               created_at=server.now_iso(), lines=lines,
               guest_token_hash="SECRET-HASH", admin_unseen=True,
               stripe_active_attempt_id="pi_secret", is_guest_order=False,
               shop_last_applied_attempt_id="att_secret")
    doc.update(kw)
    run(server.db.shop_orders.insert_one(doc))
    doc.pop("_id", None)
    return doc


def _line(kind, ref_id, name, **kw):
    out = dict(item_id=str(uuid.uuid4()), kind=kind, ref_id=ref_id, name=name,
               quantity=1, unit_price=10.0, line_subtotal=10.0, allocated_tax=0.75,
               line_total=10.0, fulfillment_status="fulfilled",
               pricing_source="override", price_override_id="po-secret")
    out.update(kw)
    return out


def _order_detail(user, order_id):
    return run(server.portal_shop_order_status(order_id, user))


def test_a_receipt_never_carries_the_internals():
    with _client() as user, _product() as p:
        o = _order(user["client_id"], [_line("product", p["id"], p["name"])])
        detail = _order_detail(user, o["id"])
        blob = str(detail)
        for secret in ("SECRET-HASH", "pi_secret", "att_secret", "po-secret",
                       "override", "admin_unseen", user["client_id"]):
            assert secret not in blob, f"{secret} leaked onto a receipt"


def test_a_receipt_shows_what_was_paid_not_what_it_costs_now():
    with _client() as user, _product(price=19.99) as p:
        o = _order(user["client_id"], [_line("product", p["id"], p["name"], unit_price=4.0,
                                             line_subtotal=4.0, line_total=4.0)])
        run(server.db.pos_products.update_one({"id": p["id"]}, {"$set": {"price": 99.0}}))
        detail = _order_detail(user, o["id"])
        # History is history: the price paid does not move when the shelf
        # price does.
        assert detail["lines"][0]["unit_price"] == 4.0


def test_a_receipt_shows_todays_picture():
    with _client() as user, _product() as p:
        run(server.db.pos_products.update_one({"id": p["id"]}, {"$set": {"image_id": "img-now"}}))
        o = _order(user["client_id"], [_line("product", p["id"], p["name"])])
        assert _order_detail(user, o["id"])["lines"][0]["image_id"] == "img-now"


def test_one_client_cannot_open_anothers_order():
    with _client() as mine, _client() as theirs, _product() as p:
        o = _order(theirs["client_id"], [_line("product", p["id"], p["name"])])
        try:
            _order_detail(mine, o["id"])
            raise AssertionError("a client read a stranger's order")
        except HTTPException as e:
            assert e.status_code == 404


def test_a_client_cannot_open_a_guest_order_by_its_id():
    with _client() as user, _product() as p:
        o = _order(None, [_line("product", p["id"], p["name"])], is_guest_order=True)
        try:
            _order_detail(user, o["id"])
            raise AssertionError("a guest order was readable without its token")
        except HTTPException as e:
            assert e.status_code == 404


def test_the_order_list_summarises_without_pricing_each_line():
    with _client() as user, _product() as p:
        _order(user["client_id"], [_line("product", p["id"], p["name"], quantity=3)])
        rows = run(server.portal_shop_orders(user))["orders"]
        assert rows[0]["item_count"] == 3
        assert rows[0]["reference"] == rows[0]["order_id"][:8].upper()
        assert "unit_price" not in str(rows[0]["lines"][0])


# ───────────────────────────────────────────────────────────── buy again

def _actions(detail, index=0):
    return {a["action"]: a for a in detail["lines"][index]["actions"]}


def test_buy_again_carries_intent_and_no_money():
    with _client() as user, _product() as p:
        o = _order(user["client_id"], [_line("product", p["id"], p["name"], quantity=2,
                                             unit_price=4.0)])
        again = _actions(_order_detail(user, o["id"]))["buy_again"]
        assert again["enabled"] is True
        assert again["ref_id"] == p["id"] and again["quantity"] == 2
        # The old price is not in the action at all, so it cannot be reused
        # as authoritative by anything downstream.
        for money in ("unit_price", "price", "line_total", "total", "tax"):
            assert money not in again


def test_buy_again_is_refused_for_something_no_longer_sold():
    with _client() as user, _product() as p:
        o = _order(user["client_id"], [_line("product", p["id"], p["name"])])
        run(server.db.pos_products.update_one({"id": p["id"]}, {"$set": {"active": False}}))
        again = _actions(_order_detail(user, o["id"]))["buy_again"]
        assert again["enabled"] is False
        assert again["reason"] == "No longer available"


def test_buy_again_is_refused_when_there_is_none_left():
    with _client() as user, _product(track_inventory=True, starting_stock=0) as p:
        o = _order(user["client_id"], [_line("product", p["id"], p["name"])])
        again = _actions(_order_detail(user, o["id"]))["buy_again"]
        assert again["enabled"] is False
        assert again["reason"] == "Out of stock"


def test_buy_again_is_refused_for_shopify_merchandise():
    with _client() as user, _product(sales_destination="shopify_external",
                                     shopify_product_url="https://example.com/x",
                                     shopify_display_price=10.0) as p:
        o = _order(user["client_id"], [_line("product", p["id"], p["name"])])
        again = _actions(_order_detail(user, o["id"]))["buy_again"]
        assert again["enabled"] is False


def test_buy_again_is_refused_for_a_course_the_dog_already_owns():
    with _client() as user, _dog(user) as dog, \
            _program(purchase_fulfillment="online_school", requires_dog=True,
                     format={"count": 8, "unit": "lessons"}) as course:
        o = _order(user["client_id"], [
            _line("training_program", course["id"], course["name"],
                  fulfillment_kind="online_school", dog_id=dog["id"], dog_name=dog["name"])])
        again = _actions(_order_detail(user, o["id"]))["buy_again"]
        assert again["enabled"] is False
        assert again["reason"] == "Already purchased for this dog"


def test_a_course_line_offers_the_course_and_names_the_dog():
    with _client() as user, _dog(user) as dog, \
            _program(purchase_fulfillment="online_school", requires_dog=True,
                     format={"count": 8, "unit": "lessons"}) as course:
        enrollment_id = str(uuid.uuid4())
        run(server.db.school_enrollments.insert_one({
            "id": enrollment_id, "client_id": user["client_id"], "dog_id": dog["id"],
            "program_id": course["id"], "enrollment_id": str(uuid.uuid4())}))
        o = _order(user["client_id"], [
            _line("training_program", course["id"], course["name"],
                  fulfillment_kind="online_school", dog_id=dog["id"], dog_name=dog["name"])])
        detail = _order_detail(user, o["id"])
        opened = _actions(detail)["open_course"]
        assert opened["enabled"] is True
        assert opened["enrollment_id"] == enrollment_id
        assert detail["lines"][0]["dog_name"] == dog["name"]
        # The dog's id is an internal handle the customer has no use for.
        assert dog["id"] not in str(detail)


def test_a_gift_card_line_shows_who_it_was_for_and_not_its_code():
    with _client() as user:
        o = _order(user["client_id"], [
            _line("gift_card", "gc-2500", "Gift card · $25.00",
                  recipient_email="nan@example.com", recipient_name="Nan",
                  gift_message="Happy birthday")])
        detail = _order_detail(user, o["id"])
        line = detail["lines"][0]
        assert line["recipient_name"] == "Nan"
        assert line["recipient_email"] == "nan@example.com"
        assert line["gift_message"] == "Happy birthday"
        # A card's redemption code lives on the card and is never fetched
        # onto an order. Nothing here should look like one.
        assert "code" not in line


def test_a_credit_pack_line_points_at_the_balance():
    with _client() as user:
        pack = run(server.create_credit_pack(server.CreditPackIn(
            name=f"{TAG} Pack", qty=5, price=99.0, available_online=True, active=True), _admin()))
        try:
            o = _order(user["client_id"], [_line("credit_pack", pack["id"], pack["name"])])
            actions = _actions(_order_detail(user, o["id"]))
            assert actions["view_credits"]["enabled"] is True
            assert actions["buy_again"]["enabled"] is True
        finally:
            run(server.db.credit_packs.delete_one({"id": pack["id"]}))


# ─────────────────────────────────────────────────── the pure helpers

def test_relationship_resolution_uses_only_the_viewers_catalogue():
    # The security property stated directly: resolve() can return nothing
    # that was not handed to it, whatever the stored references say.
    relations = [{"rel": "related", "kind": "product", "ref_id": "not-in-catalogue", "position": 0}]
    assert rel_mod.resolve(relations, []) == []


def test_reading_relationships_never_raises():
    for junk in (None, 5, "x", {"a": 1}, [None, 1, "x", {}], {"shop_relationships": 7}):
        assert isinstance(rel_mod.stored({"shop_relationships": junk}), list)


def test_reading_relationships_drops_the_junk_rather_than_passing_it_on():
    # Not just "does not raise": the rubbish must not come OUT either, or it
    # reaches resolve() and the page renders a card for a made-up reference.
    out = rel_mod.stored({"shop_relationships": [
        "a string", 7, None, [],
        {"rel": "made_up", "kind": "product", "ref_id": "x"},
        {"rel": "related", "kind": "wormhole", "ref_id": "x"},
        {"rel": "related", "kind": "product", "ref_id": ""},
        {"rel": "related", "kind": "product", "ref_id": "keep-me", "position": 0},
    ]})
    assert out == [{"rel": "related", "kind": "product", "ref_id": "keep-me", "position": 0}]


def test_the_order_reference_is_the_one_the_app_already_prints():
    oid = "abcdef12-3456-7890-abcd-ef1234567890"
    assert shop_orders_view.reference(oid) == "ABCDEF12"


def test_the_catalog_publishes_a_listing_DAY_and_keeps_created_at_to_itself():
    """The "New" badge needs a date. It does not need the stored timestamp.

    Found by the release-critical gate, not by any test written for the
    badge: the first version of this feature simply put `created_at` into
    the client catalog, and tests/test_client_shop_catalog.py's
    no-internal-leak contract caught it. The catalog is an allowlist of
    customer-facing fields, and a row's bookkeeping timestamp is not one —
    it carries a time of day and a stored precision the storefront has no
    use for.

    So what ships is `listed_on`: the business's own calendar day, derived
    server-side, which is the whole of what a "New" badge and a "Newest"
    sort actually need.
    """
    from datetime import datetime, timezone

    with _client() as user, _product() as p, _program() as prog:
        catalog = run(server._build_shop_catalog(user["client_id"]))
        by_id = {(i["kind"], i["id"]): i for i in catalog["items"]}
        product = by_id[("product", p["id"])]
        program = by_id[("training_program", prog["id"])]

        for item in (product, program):
            # The allowlist contract: bookkeeping stays on the admin side.
            assert "created_at" not in item, item.get("name")
            # A day, not a timestamp — no "T", no offset, no microseconds.
            listed = item["listed_on"]
            assert isinstance(listed, str) and len(listed) == 10, listed
            datetime.strptime(listed, "%Y-%m-%d")

        # And it is the BUSINESS's day, which is the point of deriving it
        # rather than slicing the stored UTC string: an item added at 9pm
        # Eastern is listed on that evening, not on tomorrow.
        stored = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0, "created_at": 1}))
        raw = stored["created_at"]
        if isinstance(raw, str):
            raw = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if raw.tzinfo is None:
            raw = raw.replace(tzinfo=timezone.utc)
        assert product["listed_on"] == raw.astimezone(server.BUSINESS_TZ).date().isoformat()
