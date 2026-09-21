"""Names that look like code, in emails.

Every transactional email this business sends is assembled by hand out of
f-strings and a branded wrapper, and almost everything interesting in one —
a client's name, a dog's name, a staff note, a cancellation reason, an order
line — was typed by somebody. Until now those went into the HTML as they
were. A client called `<script>alert(1)</script>` would have arrived in the
operator's inbox as a script tag, and the operator's mail client would have
been the one deciding what to do about it.

The fix is not to sanitise names on the way IN. That only ever covers the
doors you thought of, and it renames people who are legitimately called
`John <Sam> Smith`. The fix is to escape on the way OUT, at the one place a
value becomes markup — so this file checks the output, not the input.

The other half matters just as much: an operator writes real HTML into the
email templates on purpose (`intro_html`, bold text, links, the signature
block). None of that may be escaped, and nothing may be escaped twice — a
customer reading `Garrett &amp; Lexi` in their receipt is a bug, just a
quieter one.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import server
import email_service
from _test_loop import run

# The strings a determined person actually tries. Split, because they are
# dangerous in different places: markup is dangerous wherever it is written,
# whereas `javascript:` only matters in an href or a src — as the text of a
# table cell it is just a word, and asserting otherwise would be asserting
# something untrue. See the URL tests for where it does matter.
XSS = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    '"><svg onload=alert(1)>',
    "<iframe src='evil'></iframe>",
]
XSS_URLS = ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)"]
# And the ones ordinary people are actually called.
HUMAN = ["Garrett & Lexi", "O'Reilly", "John <Sam> Smith", "Ben & Jerry's", 'The "Good Boy" Club']


def _render(**kw):
    """Render through the real path, with no template override in the way."""
    return run(email_service._render(**kw))


def _is_inert(html: str, payload: str) -> bool:
    """The payload is in there, but only as words.

    Deliberately about THIS payload rather than about the document. The
    branded wrapper contains perfectly legitimate `<img>` tags — the logo,
    and the install QR code — so "no <img anywhere" would fail for the
    wrong reason and teach us nothing.

    The payload's raw form must be absent, and no tag opener that is never
    legitimate in one of our emails may appear anywhere.

    Note what is NOT checked: `onerror=`. Correctly escaped text still
    contains those characters — `&lt;img src=x onerror=alert(1)&gt;` is
    perfectly inert and says `onerror=` right there in the middle of it.
    What makes markup dangerous is the unescaped `<`, so that is what this
    looks for.
    """
    if payload in html:
        return False
    low = html.lower()
    # These three never appear in a Sit Happens email for any honest reason.
    for probe in ("<script", "<svg", "<iframe"):
        if probe in low:
            return False
    return True


def _shows_escaped(html: str, payload: str) -> bool:
    """...and the value really is in there, as words.

    Used wherever the email definitely renders the value, because "inert"
    on its own would also pass for a value that was silently dropped.
    """
    import html as _hm
    return _hm.escape(payload, quote=True) in html


# ═══════════════════════════════════════════ 1. the escaper on its own

def test_the_escaper_neutralises_markup_and_leaves_words_alone():
    for bad in XSS:
        out = email_service._h(bad)
        assert "<" not in out and ">" not in out, bad
        assert "&lt;" in out and "&gt;" in out, bad


def test_an_ampersand_is_escaped_once_and_only_once():
    # `&amp;amp;` is what double-escaping looks like in somebody's inbox.
    assert email_service._h("Garrett & Lexi") == "Garrett &amp; Lexi"
    assert email_service._h(email_service.TrustedHtml("Garrett &amp; Lexi")) == "Garrett &amp; Lexi"


def test_trusted_html_passes_through_untouched():
    markup = email_service.TrustedHtml("<strong>Day 3</strong>")
    assert email_service._h(markup) == "<strong>Day 3</strong>"


def test_nothing_is_trusted_just_because_it_looks_like_markup():
    assert email_service._h("<strong>Day 3</strong>") == "&lt;strong&gt;Day 3&lt;/strong&gt;"


def test_none_becomes_nothing_rather_than_the_word_none():
    assert email_service._h(None) == ""


def test_a_url_that_could_execute_is_not_written_at_all():
    for bad in XSS_URLS + ["JaVaScRiPt:alert(1)"]:
        assert email_service._safe_url(bad) == "", bad


def test_the_urls_we_actually_use_still_work():
    for good in ("https://sithappens.app/portal", "http://localhost:3000/",
                 "mailto:sam@example.com", "tel:+15550100", "sms:+15550100",
                 "/shop", "#top", "data:image/png;base64,iVBORw0KGgo="):
        assert email_service._safe_url(good), good


def test_a_url_is_escaped_so_it_cannot_break_out_of_the_attribute():
    out = email_service._safe_url('https://x.test/"><script>alert(1)</script>')
    assert '"' not in out and "<" not in out


# ══════════════════════════════════ 2. substitution knows where it is going

def test_a_value_dropped_into_markup_is_escaped_but_the_markup_is_not():
    out = email_service._substitute(
        "Hi <strong>{{client_name}}</strong>, welcome.",
        {"client_name": "<script>alert(1)</script>"}, into="html")
    assert "<strong>" in out, "the operator's own markup must survive"
    assert "<script>" not in out
    assert "&lt;script&gt;" in out


def test_a_subject_line_is_not_html_and_is_not_escaped():
    # It is a mail header. Escaping it would put `&amp;` in the subject.
    out = email_service._substitute("Order for {{client_name}}",
                                    {"client_name": "Garrett & Lexi"}, into="text")
    assert out == "Order for Garrett & Lexi"


def test_a_trusted_value_can_still_be_markup_when_asked_for_by_name():
    out = email_service._substitute(
        "Schedule: {{schedule_list}}",
        {"schedule_list": email_service.TrustedHtml("<br/>• Jan 1")}, into="html")
    assert "<br/>" in out


def test_choosing_a_context_is_not_optional():
    # A new call site cannot forget, because there is nothing to forget to.
    try:
        email_service._substitute("hi {{x}}", {"x": "y"})
        assert False, "into= must be required"
    except TypeError:
        pass
    try:
        email_service._substitute("hi {{x}}", {"x": "y"}, into="maybe")
        assert False, "an unknown context must be refused"
    except ValueError:
        pass


# ═══════════════════════════════════════ 3. the branded wrapper

def test_every_row_is_escaped_because_rows_are_where_the_people_are():
    for bad in XSS:
        html = email_service._wrap(title="x", intro="", rows=[("Client", bad), (bad, "v")])
        assert _is_inert(html, bad), bad
        assert _shows_escaped(html, bad), bad


def test_a_row_can_be_markup_when_it_says_so():
    html = email_service._wrap(
        title="x", intro="",
        rows=[("Skipped", email_service.TrustedHtml("Mon<br/>Tue"))])
    assert "Mon<br/>Tue" in html


def test_the_title_is_escaped_once():
    html = email_service._wrap(title="<script>alert(1)</script>", intro="", rows=[])
    assert "<script>" not in html
    assert "&lt;script&gt;" in html
    assert "&amp;lt;" not in html, "double-escaped"


def test_the_intro_is_the_operators_own_markup_and_is_left_alone():
    html = email_service._wrap(title="x", intro="Hi <strong>there</strong> — <a href='/x'>link</a>", rows=[])
    assert "<strong>there</strong>" in html
    assert "<a href='/x'>link</a>" in html


def test_the_signature_and_footer_stay_html():
    html = email_service._wrap(title="x", intro="", rows=[], settings={
        "signature_html": "<em>— The team</em>",
        "footer_html": "<a href='/unsub'>Unsubscribe</a>",
    })
    assert "<em>— The team</em>" in html
    assert "<a href='/unsub'>Unsubscribe</a>" in html


def test_a_button_cannot_be_talked_into_running_something():
    html = email_service._wrap(title="x", intro="", rows=[],
                               cta_text="Open", cta_url="javascript:alert(1)")
    assert "javascript:" not in html.lower()
    assert "Open</a>" not in html, "with no safe url there should be no button at all"


def test_a_button_url_cannot_break_out_of_its_own_attribute():
    """The refusal test above passes even with escaping removed, because a
    refused URL means no button at all. This one uses a URL with a perfectly
    good scheme that then closes the quote — the only thing standing between
    that and an onclick handler is escaping the attribute."""
    html = email_service._wrap(
        title="x", intro="", rows=[],
        cta_text="Open", cta_url='https://x.test/" onclick="alert(1)')
    # Unescaped, the quote closes href and `onclick` becomes a real
    # attribute. Escaped, the same characters are part of the URL text.
    assert '" onclick="' not in html, "the attribute was broken out of"
    assert "&quot; onclick=" in html, "the quote was escaped, not dropped"


def test_the_button_label_is_escaped():
    bad = "<img src=x onerror=alert(1)>"
    html = email_service._wrap(title="x", intro="", rows=[],
                               cta_text=bad, cta_url="https://x.test/")
    assert _is_inert(html, bad)


def test_a_branding_logo_url_is_checked_and_the_brand_name_escaped():
    html = email_service._wrap(title="x", intro="", rows=[], settings={
        "logo_url": "javascript:alert(1)", "brand_name": '"><script>alert(1)</script>'})
    assert "javascript:" not in html.lower()
    assert "<script>" not in html


def test_a_real_name_survives_the_wrapper_intact():
    for name in HUMAN:
        html = email_service._wrap(title=name, intro="", rows=[("Client", name)])
        # Escaped once — unescaping gets exactly the name back.
        import html as _h
        assert _h.unescape(_h.unescape(html)).count(name) >= 2 or _h.unescape(html).count(name) >= 2, name
        assert "&amp;amp;" not in html, f"double-escaped: {name}"


# ════════════════════════════════════ 4. real emails, end to end

def _no_template_overrides():
    run(server.db.email_templates.delete_many({"slug": {"$in": [
        "admin_new_shop_order", "gift_card_delivered", "client_booking_approved",
        "admin_new_client",
    ]}}))
    email_service.invalidate_template_cache()


def test_the_admin_new_order_email_is_safe_for_a_guest_named_like_code():
    """The exact path that started this: a stranger types a name at guest
    checkout and an operator opens the resulting email."""
    _no_template_overrides()
    for bad in XSS[:3]:
        order = {
            "id": str(uuid.uuid4()), "client_name": bad, "client_email": "x@example.com",
            "total": 25.0, "is_guest_order": True, "fulfillment_status": "fulfilled",
            "lines": [{"kind": "product", "name": bad, "quantity": 1}],
        }
        subject, html = _render(
            slug="admin_new_shop_order",
            ctx={"client_name": bad, "order_number": "ABC", "total": "25.00", "items": bad},
            rows=[("Client", bad), ("Items", f"1× {bad}")],
            fallback_subject="New order", fallback_title="New Shop order",
            fallback_intro=f"{email_service._h(bad)} just paid for a Shop order.",
        )
        assert _is_inert(html, bad), bad
        assert _shows_escaped(html, bad), bad
        # The subject is a mail header, not markup, so nothing escapes it.
        # This template's shipped subject carries no customer text, but it
        # must not have picked up entities on the way through either.
        assert "&lt;" not in subject and "&amp;" not in subject, subject


def test_the_same_email_for_a_signed_in_client():
    _no_template_overrides()
    bad = '"><svg onload=alert(1)>'
    _, html = _render(
        slug="admin_new_shop_order",
        ctx={"client_name": bad, "order_number": "ABC", "total": "10.00", "items": "1× Leash"},
        rows=[("Client", bad)],
        fallback_subject="New order", fallback_title="New Shop order",
        fallback_intro="A client just paid for a Shop order.",
    )
    assert _is_inert(html, bad)
    assert _shows_escaped(html, bad)


def test_the_gift_card_email_is_safe_in_the_name_and_the_note():
    _no_template_overrides()
    bad = "<img src=x onerror=alert(1)>"
    _, html = _render(
        slug="gift_card_delivered",
        ctx={"first_name": bad, "code": "GC-1234", "amount": "25.00"},
        rows=[("For", bad)],
        fallback_subject="Your gift card", fallback_title="A gift card for you",
        fallback_intro="",
        # The gift-card domain escapes its own body before handing it over;
        # that stays markup, and must not be escaped a second time.
        body_html="<p>Hi &lt;img src=x&gt;,</p><strong>GC-1234</strong>",
    )
    assert _is_inert(html, bad)
    assert _shows_escaped(html, bad), "the recipient name is rendered, escaped"
    assert "<strong>GC-1234</strong>" in html, "the card body is deliberate markup"
    assert "&amp;lt;" not in html, "double-escaped"


def test_a_non_shop_email_using_the_shared_renderer():
    # Booking approval — a dog name and a staff note, nothing to do with the Shop.
    _no_template_overrides()
    bad = "<script>alert('dog')</script>"
    _, html = _render(
        slug="client_booking_approved",
        ctx={"first_name": bad, "dog_name": bad, "service_label": "Daycare",
             "date_range": "Jan 1 – Jan 3", "client_name": bad},
        rows=[("Dog", bad), ("Service", "Daycare")],
        fallback_subject="Approved", fallback_title="Booking approved",
        fallback_intro="Your booking is approved.",
    )
    assert _is_inert(html, bad)
    assert _shows_escaped(html, bad)


def test_the_intentional_markup_in_a_real_template_still_renders():
    """client_booking_approved's shipped intro_html has <strong> in it. If
    the escaping went one layer too far, this is what would break — and it
    would break quietly, in every email, for everyone."""
    _no_template_overrides()
    _, html = _render(
        slug="client_booking_approved",
        ctx={"first_name": "Sam", "dog_name": "Rex", "service_label": "Daycare",
             "date_range": "Jan 1 – Jan 3", "client_name": "Sam Jones"},
        rows=[("Dog", "Rex")],
        fallback_subject="s", fallback_title="t", fallback_intro="i",
    )
    assert "<strong>Rex</strong>" in html, "the template's own tags must survive"
    assert "&lt;strong&gt;" not in html


def test_a_customer_named_garrett_and_lexi_reads_their_own_name():
    _no_template_overrides()
    _, html = _render(
        slug="client_booking_approved",
        ctx={"first_name": "Garrett & Lexi", "dog_name": "Ben & Jerry's",
             "service_label": "Daycare", "date_range": "Jan 1", "client_name": "O'Reilly"},
        rows=[("Client", "Garrett & Lexi"), ("Dog", "Ben & Jerry's"), ("Booked by", "O'Reilly")],
        fallback_subject="s", fallback_title="t", fallback_intro="i",
    )
    import html as _hm
    plain = _hm.unescape(html)
    assert "Garrett & Lexi" in plain
    assert "Ben & Jerry's" in plain
    assert "O'Reilly" in plain
    assert "&amp;amp;" not in html, "double-escaped"


def test_an_operator_who_writes_a_tag_into_a_title_sees_it_as_words():
    """A title is plain text by contract. An override that puts markup there
    is shown literally rather than executed — the secure default."""
    slug = "admin_new_client"
    run(server.db.email_templates.update_one(
        {"slug": slug},
        {"$set": {"slug": slug, "title": "<script>alert(1)</script> New client",
                  "intro_html": "Hi <strong>{{client_name}}</strong>"}},
        upsert=True))
    email_service.invalidate_template_cache()
    try:
        _, html = _render(slug=slug, ctx={"client_name": "<b>Mallory</b>"}, rows=[],
                          fallback_subject="s", fallback_title="t", fallback_intro="i")
        assert "<script>" not in html
        assert "<strong>" in html, "the operator's intro markup still renders"
        assert "<b>Mallory</b>" not in html, "but a client's name is not markup"
        assert "&lt;b&gt;Mallory" in html
    finally:
        run(server.db.email_templates.delete_many({"slug": slug}))
        email_service.invalidate_template_cache()


# ═══════════════════════════════ 5. the paths that build their own HTML

def test_the_payment_agreement_escapes_the_client_but_keeps_its_schedule():
    plan = {
        "client_name": "<script>alert(1)</script>",
        "program_name": "Garrett & Lexi's Programme",
        "total_amount": 500.0,
        "installments": [{"due_date": "2026-01-01", "amount": 250.0},
                         {"due_date": "2026-02-01", "amount": 250.0}],
    }
    out = server._render_agreement(plan, {"business_name": "Sit Happens"})
    assert "<script>" not in out
    assert "&lt;script&gt;" in out
    # The schedule is deliberate markup built from dates and money.
    assert "<br/>" in out and "<strong>2026-01-01</strong>" in out
    import html as _hm
    assert "Garrett & Lexi's Programme" in _hm.unescape(out)


def test_the_announcement_blast_keeps_line_breaks_and_nothing_else():
    # The body is typed as plain text; only its newlines become markup.
    body = "Hi all\n<script>alert(1)</script>\nSee you Saturday"
    safe = email_service.TrustedHtml(email_service._h(body).replace("\n", "<br/>"))
    assert "<br/>" in safe
    assert "<script>" not in safe
    assert "&lt;script&gt;" in safe
