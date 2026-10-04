"""A return put back on a gift card reads "Gift card" in the Register activity,
not "Other" (audit: "Money put back on a gift card shows as 'Other' in the
Register activity"). Disposable tag TEST_GC_LABEL — no data is written."""
import _test_env  # noqa: F401 — must run before `import server`
import server


def test_a_gift_card_refund_is_labelled_gift_card():
    assert server._method_label("gift_card") == "Gift card"


def test_the_other_labels_are_unchanged():
    assert server._method_label("cash") == "Cash"
    assert server._method_label("card") == "Card"
    assert server._method_label("bogus-method") == "Other"
