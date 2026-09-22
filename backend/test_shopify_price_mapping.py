"""The price a Shopify-linked product shows, and the price it must never show.

Every Shopify product in the Shop advertised itself as $0.00. The catalogue
row for a `shopify_external` product carried `shopify_display_price` but no
`price` key at all, and the storefront card rendered `money(item.price)` —
`money(undefined)` is `$0.00`. Nothing was wrong with the data; the mapping
simply dropped it, and the display filled the hole with a number that made the
merchandise look free.

The rule these tests exist to hold: a price we do not have is not zero.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

from domains.shop import shopify_pricing

TAG = "TEST_SHOPIFY_PRICE"


# ───────────────────────────────────────── the five shapes

def test_a_single_variant_shows_its_price_plainly():
    r = shopify_pricing.resolve({"variants": [{"price": "24.99"}]})
    assert r["has_price"] is True
    assert r["amount"] == 24.99
    assert r["from_price"] is False
    assert r["display"] == "$24.99"


def test_variants_at_the_same_price_are_not_a_range():
    """Three variants, one price. "From $24.99" would imply a cheaper option
    exists and send the customer looking for it."""
    r = shopify_pricing.resolve({"variants": [
        {"price": "24.99"}, {"price": "24.99"}, {"price": 24.99},
    ]})
    assert r["display"] == "$24.99"
    assert r["from_price"] is False


def test_variants_at_different_prices_show_the_lowest_as_a_floor():
    r = shopify_pricing.resolve({"variants": [
        {"price": "34.99"}, {"price": "24.99"}, {"price": "29.99"},
    ]})
    assert r["amount"] == 24.99, "must be the lowest, not the first"
    assert r["from_price"] is True
    assert r["display"] == "From $24.99"


def test_a_missing_price_is_never_zero():
    """The actual bug. Each of these used to render as $0.00."""
    for doc in ({}, {"variants": []}, {"shopify_display_price": None},
                {"variants": [{"price": None}]}, {"variants": [{"price": ""}]},
                {"priceRange": {}}):
        r = shopify_pricing.resolve(doc)
        assert r["has_price"] is False, doc
        assert r["amount"] is None, doc
        assert r["display"] is None, doc


def test_decimal_and_string_shopify_values_all_parse():
    """Shopify sends money as a string over REST and GraphQL alike."""
    assert shopify_pricing.resolve({"variants": [{"price": "24.99"}]})["amount"] == 24.99
    assert shopify_pricing.resolve({"variants": [{"price": 24.99}]})["amount"] == 24.99
    assert shopify_pricing.resolve({"variants": [{"price": 25}]})["display"] == "$25.00"
    assert shopify_pricing.resolve({"variants": [{"price": "  24.50  "}]})["amount"] == 24.5
    assert shopify_pricing.resolve({"variants": [{"price": "1299.00"}]})["display"] == "$1,299.00"
    # Junk is absence, not zero.
    assert shopify_pricing.resolve({"variants": [{"price": "free"}]})["has_price"] is False
    # bool is an int in Python; True must not read as $1.00.
    assert shopify_pricing.resolve({"variants": [{"price": True}]})["has_price"] is False


# ───────────────────────────────────────── the other shapes and the edges

def test_the_graphql_price_range_shape_is_understood():
    same = shopify_pricing.resolve({"priceRange": {
        "minVariantPrice": {"amount": "24.99", "currencyCode": "USD"},
        "maxVariantPrice": {"amount": "24.99", "currencyCode": "USD"}}})
    assert same["display"] == "$24.99"
    spread = shopify_pricing.resolve({"priceRange": {
        "minVariantPrice": {"amount": "24.99"},
        "maxVariantPrice": {"amount": "39.99"}}})
    assert spread["display"] == "From $24.99"


def test_the_hand_entered_mirror_still_works():
    """There is no Shopify API in this project yet — these two fields are the
    whole integration, and they must keep working exactly as before."""
    assert shopify_pricing.resolve({"shopify_display_price": 24.99})["display"] == "$24.99"
    assert shopify_pricing.resolve(
        {"shopify_display_price": 24.99, "shopify_from_price": True})["display"] == "From $24.99"
    # A "from" flag with no number cannot invent one.
    assert shopify_pricing.resolve({"shopify_from_price": True})["has_price"] is False


def test_structured_shopify_data_wins_over_a_typed_in_number():
    """Shopify owns these prices. A hand-entered figure is the one most likely
    to be stale, so it loses to anything synced."""
    r = shopify_pricing.resolve({
        "shopify_display_price": 9.99,
        "variants": [{"price": "24.99"}],
    })
    assert r["amount"] == 24.99


def test_sold_out_variants_do_not_advertise_a_price_nobody_can_buy():
    r = shopify_pricing.resolve({"variants": [
        {"price": "19.99", "availableForSale": False},
        {"price": "24.99", "availableForSale": True},
    ]})
    assert r["amount"] == 24.99, "the $19.99 variant cannot be bought"
    assert r["from_price"] is False
    # But if the whole product is sold out, its price is still the truth.
    allgone = shopify_pricing.resolve({"variants": [
        {"price": "19.99", "available": False}, {"price": "24.99", "available": False},
    ]})
    assert allgone["amount"] == 19.99
    assert allgone["from_price"] is True


# ───────────────────────────────────────── the DTO the storefront actually reads

def _shopify_product(**extra):
    doc = {
        "id": str(uuid.uuid4()), "name": f"{TAG} Tag {uuid.uuid4().hex[:6]}",
        "kind": "physical_product", "active": True, "show_online": True,
        "sales_destination": "shopify_external",
        "shopify_product_url": "https://sithappens-shop.myshopify.com/products/tag",
        "price": 0.0,
    }
    doc.update(extra)
    return doc


def test_the_catalogue_row_carries_a_price_key_at_all():
    """The regression itself: the row had no `price`, so the card read
    undefined and printed $0.00."""
    fields = server._shopify_price_fields(_shopify_product(shopify_display_price=24.99))
    assert "price" in fields
    assert fields["price"] == 24.99
    assert fields["shopify_price"]["display"] == "$24.99"


def test_a_shopify_row_with_no_price_reports_none_not_zero():
    fields = server._shopify_price_fields(_shopify_product())
    assert fields["price"] is None, "None means unknown; 0 means free, and it is not free"
    assert fields["shopify_price"]["has_price"] is False


def test_the_price_is_stripped_when_public_pricing_is_hidden():
    """shopify_price carries the amount, so it has to be gated like every
    other price field — otherwise it is a side channel around the setting."""
    assert "shopify_price" in server._PUBLIC_FIELDS_PRICE
