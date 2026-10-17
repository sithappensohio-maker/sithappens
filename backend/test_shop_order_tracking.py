"""Customer-facing shipment tracking on a Shop order's receipt (owner request,
2026-10-17: "tracking would be nice"). Was captured and emailed once but never
reachable afterward in the customer's own order history — this is the fix.

Two sources, one shape (domains.shop.orders._tracking): a self-fulfilled
(FedEx) order only ever has a bare admin-typed tracking_number, so the real
FedEx tracking URL is built here; a Printify order already carries a real
{code, number, url} from Printify's own shipment webhook
(domains.printify.client.apply_webhook_event), read from printify_order_outbox
by the caller and handed in. Disposable tag TEST_SHOP_TRACKING.
"""
import _test_env  # noqa: F401 — must run before `import server`
from domains.shop import orders as shop_orders_view


def test_no_tracking_at_all_when_nothing_has_shipped():
    order = {"id": "o1"}
    out = shop_orders_view.detail(order, items_by_ref={}, actions_by_item_id={})
    assert out["tracking"] is None
    assert out["shipping_status"] is None
    assert out["shipped_at"] is None


def test_self_fulfilled_fedex_tracking_builds_the_real_url():
    order = {"id": "o2", "shipping_status": "shipped", "shipped_at": "2026-10-16T12:00:00Z",
             "tracking_number": "9400111"}
    out = shop_orders_view.detail(order, items_by_ref={}, actions_by_item_id={})
    assert out["shipping_status"] == "shipped"
    assert out["shipped_at"] == "2026-10-16T12:00:00Z"
    assert out["tracking"] == {
        "number": "9400111", "carrier": "FedEx",
        "url": "https://www.fedex.com/fedextrack/?trknbr=9400111",
    }


def test_printify_tracking_passes_through_its_own_real_carrier_and_url():
    order = {"id": "o3"}
    printify_tracking = {"code": "usps", "number": "EZ1234", "url": "https://tools.usps.com/go/x"}
    out = shop_orders_view.detail(order, items_by_ref={}, actions_by_item_id={},
                                   printify_tracking=printify_tracking)
    assert out["tracking"] == {"number": "EZ1234", "carrier": "USPS", "url": "https://tools.usps.com/go/x"}


def test_fedex_number_wins_over_a_printify_row_that_doesnt_apply_to_this_order():
    # An order is one or the other, never both, but the function itself
    # should never silently prefer the wrong one if it somehow got both.
    order = {"id": "o4", "tracking_number": "9400222"}
    out = shop_orders_view.detail(order, items_by_ref={}, actions_by_item_id={},
                                   printify_tracking={"code": "ups", "number": "1Z999", "url": "https://x"})
    assert out["tracking"]["number"] == "9400222"
    assert out["tracking"]["carrier"] == "FedEx"


def test_printify_outbox_row_with_no_number_yet_is_not_shown_as_tracking():
    # order:sent-to-production / order:updated events never set a number —
    # a row can exist with only printify_status, no tracking yet.
    order = {"id": "o5"}
    out = shop_orders_view.detail(order, items_by_ref={}, actions_by_item_id={},
                                   printify_tracking=None)
    assert out["tracking"] is None
