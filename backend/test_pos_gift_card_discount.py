"""A discount on a register cart never comes off a gift card (audit #4: "A
discount on a register cart that includes a gift card shorts the card and can
leave a paid-for card dead"). A card is sold at its face value, so the discount
is taken off the other lines; a discount on a card-only cart is refused. A cart
with no card is discounted as before. Disposable tag TEST_GC_DISCOUNT."""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from fastapi import HTTPException
from _test_loop import run
from domains.pos import services as pos

TAG = "TEST_GC_DISCOUNT"


def _product(price):
    pid = str(uuid.uuid4())
    run(server.db.pos_products.insert_one({
        "id": pid, "name": f"{TAG} item", "price": price, "active": True, "archived": False,
        "show_at_register": True, "track_inventory": False, "stock_on_hand": 0, "taxable": True,
        "category": "", "description": "", "sku": "", "category_id": None, "subcategory_id": None}))
    return pid


@pytest.fixture(autouse=True)
def _cleanup():
    yield
    run(server.db.pos_products.delete_many({"name": f"{TAG} item"}))


def _gift_card(amount=50.0):
    return server.PosSaleLineIn(kind="gift_card", gift_card_amount=amount, qty=1)


def _goods(pid, qty=1):
    return server.PosSaleLineIn(kind="retail", product_id=pid, qty=qty)


def _price(lines, discount=None):
    priced, _ = run(pos.price_pos_cart(lines, discount, can_price=True))
    return priced


def _line(priced, kind):
    return next(li for li in priced["line_items"] if li["kind"] == kind)


def test_a_cart_discount_is_not_taken_off_the_gift_card():
    pid = _product(20.00)
    priced = _price([_gift_card(50.0), _goods(pid)],
                    server.PosSaleDiscountIn(kind="fixed", value=10.0, reason=f"{TAG} deal"))
    card = _line(priced, "gift_card")
    assert card["allocated_discount"] == 0 and card["net_amount"] == 50.0, "the card is sold at its face value"
    assert _line(priced, "retail")["net_amount"] == 10.0, "the whole discount comes off the goods"
    assert priced["discount_amount"] == 10.0


def test_a_percent_discount_is_worked_out_on_the_goods_only():
    pid = _product(20.00)
    priced = _price([_gift_card(50.0), _goods(pid)],
                    server.PosSaleDiscountIn(kind="percent", value=10.0, reason=f"{TAG} deal"))
    assert priced["discount_amount"] == 2.0, "10% of the goods ($20), not of the cart ($70)"
    assert _line(priced, "gift_card")["net_amount"] == 50.0


def test_a_discount_on_a_gift_card_alone_is_refused():
    with pytest.raises(HTTPException) as err:
        _price([_gift_card(50.0)], server.PosSaleDiscountIn(kind="fixed", value=10.0, reason=f"{TAG} deal"))
    assert err.value.status_code == 400
    assert "gift card" in err.value.detail


def test_a_cart_with_no_gift_card_is_discounted_as_before():
    pid = _product(20.00)
    priced = _price([_goods(pid)], server.PosSaleDiscountIn(kind="fixed", value=5.0, reason=f"{TAG} deal"))
    assert priced["discount_amount"] == 5.0 and _line(priced, "retail")["net_amount"] == 15.0
