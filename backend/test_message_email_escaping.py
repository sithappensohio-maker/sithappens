"""A portal message reaches the owner's inbox as text, never as markup (audit
#9: "Anyone with a portal login can put their own links and HTML into the
owner's 'new message' emails"). The body is typed by a family member, so a link
or a tag reads as plain text, and an honest '<Leave It>' still shows. Disposable
tag TEST_MSG_EMAIL."""
import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_MSG_EMAIL"
THREAD = {"id": f"{TAG}-t", "subject": "Hi <b>there</b>", "client_name": "Dana <i>Q</i>"}


@pytest.fixture()
def sent(monkeypatch):
    out = []

    async def fake_send(to, subject, html):
        out.append({"to": to, "subject": subject, "html": html})
        return True
    monkeypatch.setattr(server.email_service, "_send", fake_send)
    return out


def _notify(body):
    return run(server._send_message_notification_email(THREAD, "owner@example.com", body, is_admin_reply=False))


def test_a_link_in_a_message_is_shown_as_text(sent):
    assert _notify('Please verify <a href="https://phish.example/login">your account</a> now') is True
    html = sent[0]["html"]
    assert 'href="https://phish.example' not in html, "no live link from a family's message"
    assert "&lt;a href=" in html


def test_a_message_with_a_cue_in_angle_brackets_keeps_its_words(sent):
    _notify("Use the <Leave It> cue first")
    html = sent[0]["html"]
    assert "&lt;Leave It&gt;" in html
    assert "<Leave It>" not in html


def test_a_script_in_a_message_is_inert(sent):
    _notify("hello <script>steal()</script>")
    assert "<script>steal()" not in sent[0]["html"]


def test_an_ordinary_message_still_reads_normally(sent):
    _notify("Can we move Friday to 9?\nThanks")
    html = sent[0]["html"]
    assert "Can we move Friday to 9?" in html and "Thanks" in html
