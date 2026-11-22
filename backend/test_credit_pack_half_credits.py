"""A credit pack can hold a half credit.

Owner request: a "2 dogs, 1 day" daycare pack is 1.5 credits (a two-dog
daycare day costs 1.5), priced $45. The pack editor and every sale path used
to force the credit count to a whole number, so the pack could not be made —
and a 1.5 pack that did get in would have been cut down to 1 credit on its
way to the client's balance.

These tests sell a real 1.5-credit pack and check the client really gets 1.5.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run
from pydantic import ValidationError

from test_credit_pack_display_fields import _OpenRegisterDay, _admin_user, _client, _find, _pack

TAG = "TEST_PACK_HALF"

TWO_DOG_ONE_DAY = dict(qty=1.5, price=45.0, service_type="daycare",
                       display_quantity=1, display_unit="day", display_dog_count=2)


def _credits(client_id):
    doc = run(server.db.clients.find_one({"id": client_id}, {"_id": 0, "credits": 1})) or {}
    return float(doc.get("credits") or 0)


def test_pack_can_be_created_with_one_and_a_half_credits():
    with _pack(**TWO_DOG_ONE_DAY) as pack:
        assert pack["qty"] == 1.5
        assert pack["value_each"] == 30.0  # $45 / 1.5 credits


def test_whole_number_packs_still_store_a_plain_whole_number():
    with _pack(qty=10, price=300.0) as pack:
        assert pack["qty"] == 10
        assert isinstance(pack["qty"], int)


def test_quarter_credits_are_refused():
    for bad in (1.25, 0.5, 0):
        try:
            server.CreditPackIn(name="x", qty=bad, price=45)
            assert False, f"expected qty={bad} to be refused"
        except ValidationError:
            pass


def test_selling_the_pack_grants_exactly_one_and_a_half_credits():
    with _client() as client, _pack(**TWO_DOG_ONE_DAY) as pack, _OpenRegisterDay(TAG):
        before = _credits(client["id"])
        lot = run(server.sell_credit_pack(client["id"], server.SellCreditPackIn(pack_id=pack["id"]), _admin_user()))
        assert lot["qty_total"] == 1.5
        assert lot["qty_remaining"] == 1.5
        assert lot["value_each"] == 30.0
        assert _credits(client["id"]) - before == 1.5


def test_bulk_sale_of_two_packs_grants_three_credits():
    with _client() as client, _pack(**TWO_DOG_ONE_DAY) as pack, _OpenRegisterDay(TAG):
        before = _credits(client["id"])
        body = server.SellCreditPacksBulkIn(items=[server.SellCreditPackItem(pack_id=pack["id"], quantity=2)])
        out = run(server.sell_credit_packs_bulk(client["id"], body, _admin_user()))
        lots = run(server.db.credit_lots.find({"client_id": client["id"], "pack_id": pack["id"]}, {"_id": 0}).to_list(10))
        assert [l["qty_total"] for l in lots] == [1.5, 1.5]
        assert _credits(client["id"]) - before == 3.0
        assert out["receipt"]["lines"][0]["pack_qty"] == 1.5
        assert out["receipt"]["totals"]["daycare"]["qty"] == 3.0


def test_catalogs_show_one_and_a_half_credits_not_one():
    with _pack(**TWO_DOG_ONE_DAY) as pack:
        shop = _find(run(server._build_shop_catalog(None))["items"], pack["id"])
        assert shop["qty"] == 1.5
        assert shop["display_price_each"] == 45.0
        assert shop["credits_per_display_unit"] == 1.5
        register = _find(run(server._build_register_catalog(None))["items"], pack["id"])
        assert register["qty"] == 1.5
        admin_row = _find(run(server.list_credit_packs(_admin_user(), include_inactive=True)), pack["id"])
        assert admin_row["qty"] == 1.5
        assert admin_row["value_each"] == 30.0


def test_register_sale_grants_one_and_a_half_and_void_takes_it_all_back():
    """The Front Desk register is how the pack is really sold. Ringing it up
    must add 1.5 credits, and voiding that sale must take back all 1.5 — not
    1, which would leave the client holding a free half credit."""
    owner = {"id": "test-user", "name": f"{TAG} owner", "email": "qa@test", "role": "admin"}
    with _client(credits=0) as client, _pack(**TWO_DOG_ONE_DAY) as pack, _OpenRegisterDay(TAG):
        sale_id = None
        try:
            body = server.PosSaleIn(
                client_id=client["id"],
                lines=[server.PosSaleLineIn(kind="credit_pack", pack_id=pack["id"], qty=1)],
                tenders=[server.PosSaleTenderIn(method="card", amount=45.0)],
                idempotency_key=f"{TAG}-{uuid.uuid4()}",
            )
            sale = run(server.create_pos_sale(body, owner))
            sale_id = sale["pos_sale_id"]
            lot = run(server.db.credit_lots.find_one({"pos_sale_id": sale_id}, {"_id": 0}))
            assert lot["qty_total"] == 1.5
            assert lot["value_each"] == 30.0
            assert _credits(client["id"]) == 1.5

            run(server.void_pos_sale(sale_id, server.PosSaleVoidIn(
                reason=f"{TAG} rung wrong", idempotency_key=f"{TAG}-void-{uuid.uuid4()}"), owner))
            assert _credits(client["id"]) == 0
        finally:
            if sale_id:
                run(server.db.pos_sales.delete_many({"$or": [{"id": sale_id}, {"void_of_sale_id": sale_id}, {"pos_sale_id": sale_id}]}))
                run(server.db.retail_sales.delete_many({"pos_sale_id": sale_id}))
                run(server.db.credit_lots.delete_many({"pos_sale_id": sale_id}))


def test_a_two_dog_day_spends_the_whole_pack():
    """The point of the pack: one two-dog daycare day (1.5 credits) uses it up
    exactly, leaving nothing stranded."""
    with _client() as client, _pack(**TWO_DOG_ONE_DAY) as pack, _OpenRegisterDay(TAG):
        run(server.sell_credit_pack(client["id"], server.SellCreditPackIn(pack_id=pack["id"]), _admin_user()))
        value, redemptions, used = run(server._consume_credit_lots(client["id"], 1.5, "daycare"))
        assert used == 1.5
        assert round(value, 2) == 45.0  # the whole $45 the client paid is used up
        lot = run(server.db.credit_lots.find_one({"client_id": client["id"], "pack_id": pack["id"]}, {"_id": 0}))
        assert lot["qty_remaining"] == 0
