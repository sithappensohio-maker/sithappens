"""Regression tests for the physical thermal-receipt formatter.

Bug: the printed receipt on real hardware did not match the business's
configured Receipt Settings (address/phone/email missing, a hardcoded
"DOG TRAINING" subtitle and "THANK YOU" footer instead of the real
business name/thank-you message, no public-price-vs-your-price line, no
remaining-prepaid-visits line, and no "TEST RECEIPT" banner on test
prints) even though the in-app digital/thermal preview showed all of it
correctly. Root cause: this file's ESC/POS formatter never read those
fields from the payload at all — this test suite locks in that it now
does, using the exact field names `_apply_receipt_settings_branding` /
`_apply_receipt_settings_visibility` (backend/server.py) put on the
payload.
"""
import re
import pos_agent


def _decode(raw: bytes) -> str:
    """Strip ESC/GS control sequences so assertions can match plain text."""
    text = re.sub(rb"\x1b.", b"", raw)
    text = re.sub(rb"\x1d.", b"", text)
    return text.decode("utf-8", errors="replace")


BASE_PAYLOAD = {
    "kind": "invoice",
    "receipt_number": "A1B2C3D4",
    "date_time": "2026-07-31T18:12:00Z",
    "client_name": "Real Client",
    "dogs": ["Real Dog"],
    "service_dates": None,
    "staff_name": None,
    "booking_reference": None,
    "line_items": [{"description": "Daycare (per day)", "qty": 1, "amount": 40.0}],
    "invoice_total": 40.0,
    "credits_applied": 0.0,
    "payment_amount": 40.0,
    "payment_method": "cash",
    "remaining_balance": 0.0,
    "tendered_amount": 40.0,
    "change_given": 0.0,
    "remaining_prepaid_visits": None,
    "public_price_note": None,
    "business_name": "Sit Happens Dog Training",
    "business_address": "137 N St NW",
    "business_phone": "330-978-5575",
    "business_email": "sithappensohio@gmail.com",
    "business_website": "",
    "thank_you_message": "Thank you for choosing Sit Happens!",
    "policy_footer_message": "",
}


def test_business_identity_from_settings_is_printed():
    text = _decode(pos_agent.format_receipt(dict(BASE_PAYLOAD)))
    assert "Sit Happens Dog Training" in text
    assert "137 N St NW" in text
    assert "330-978-5575" in text
    assert "sithappensohio@gmail.com" in text
    # The old hardcoded subtitle must be gone.
    assert "DOG TRAINING" not in text


def test_configured_thank_you_and_policy_message_used_not_hardcoded():
    payload = dict(BASE_PAYLOAD, policy_footer_message="No refunds after 24 hours.")
    text = _decode(pos_agent.format_receipt(payload))
    assert "Thank you for choosing Sit Happens!" in text
    assert "No refunds after 24 hours." in text
    # Bare "THANK YOU" must not appear as a standalone hardcoded fallback
    # when a real message is configured.
    assert "THANK YOU" not in text


def test_hidden_fields_are_omitted_not_fabricated():
    text = _decode(pos_agent.format_receipt(dict(BASE_PAYLOAD)))
    assert "Staff:" not in text
    assert "Booking Ref:" not in text
    assert "Service date:" not in text
    assert "Public price:" not in text
    assert "Visits remaining" not in text


def test_visible_extras_are_printed_when_present():
    payload = dict(
        BASE_PAYLOAD,
        staff_name="Sample Staff",
        booking_reference="SAMPLE01",
        service_dates=[{"date": "2026-07-31", "end_date": None, "dog_name": "Real Dog"}],
        remaining_prepaid_visits={"daycare": 3, "training": 0, "boarding": 0},
        public_price_note={"list_price": 45.0, "effective_price": 40.0},
    )
    text = _decode(pos_agent.format_receipt(payload))
    assert "Staff: Sample Staff" in text
    assert "Booking Ref: SAMPLE01" in text
    assert "Service date:" in text and "2026-07-31" in text
    assert "Public price: $45.00" in text and "Your price: $40.00" in text
    assert "Daycare: 3" in text and "Training: 0" in text and "Boarding: 0" in text


def test_test_receipt_banner_only_on_test_prints():
    real = _decode(pos_agent.format_receipt(dict(BASE_PAYLOAD)))
    assert "TEST RECEIPT" not in real

    test_payload = dict(BASE_PAYLOAD, test_receipt=True, test_label="TEST RECEIPT - NOT A TRANSACTION")
    test_text = _decode(pos_agent.format_receipt(test_payload))
    assert "TEST RECEIPT - NOT A TRANSACTION" in test_text


def test_tab_payment_and_pos_sale_receipts_also_use_configured_branding_and_footer():
    tab_payload = {
        "kind": "tab_payment",
        "receipt_number": "L1L2L3L4",
        "date_time": "2026-07-31T18:12:00Z",
        "client_name": "Real Client",
        "staff_name": None,
        "line_items": [{"description": "Account payment", "qty": 1, "amount": 25.0}],
        "payment_amount": 25.0,
        "payment_method": "cash",
        "tendered_amount": None,
        "change_given": None,
        "remaining_prepaid_visits": {"daycare": 1, "training": 0, "boarding": 0},
        "public_price_note": None,
        "business_name": "Sit Happens Dog Training",
        "business_address": "137 N St NW",
        "business_phone": "",
        "business_email": "",
        "business_website": "",
        "thank_you_message": "Thank you for choosing Sit Happens!",
        "policy_footer_message": "",
    }
    text = _decode(pos_agent.format_receipt(tab_payload))
    assert "Sit Happens Dog Training" in text
    assert "Thank you for choosing Sit Happens!" in text
    assert "Daycare: 1" in text

    pos_sale_payload = {
        "kind": "pos_sale",
        "receipt_number": "S1S2S3S4",
        "date_time": "2026-07-31T18:12:00Z",
        "client_name": None,
        "line_items": [{"description": "Leash", "qty": 1, "amount": 20.0}],
        "subtotal": 20.0,
        "discount_amount": 0.0,
        "tax_amount": 1.4,
        "total": 21.4,
        "payment_method": "card",
        "tendered_amount": None,
        "change_given": None,
        "business_name": "Sit Happens Dog Training",
        "business_address": "137 N St NW",
        "business_phone": "",
        "business_email": "",
        "business_website": "",
        "thank_you_message": "Thank you for choosing Sit Happens!",
        "policy_footer_message": "",
    }
    text = _decode(pos_agent.format_receipt(pos_sale_payload))
    assert "Sit Happens Dog Training" in text
    assert "Thank you for choosing Sit Happens!" in text
