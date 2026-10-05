"""A draft published later is emailed once, when it goes live (audit #63: "Announcement
saved as a draft and published later is never emailed"). Publishing again, or editing,
does not email it again. Disposable tag TEST_ANN_PUB."""
import asyncio

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run
import email_service

TAG = "TEST_ANN_PUB"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": "QA", "email": "qa@test"}


@pytest.fixture()
def sent(monkeypatch):
    calls = []

    async def fake(doc):
        calls.append(doc.get("id"))
        return {"sent": 1}
    monkeypatch.setattr(email_service, "broadcast_announcement_email", fake)
    yield calls
    run(server.db.announcements.delete_many({"tag": TAG}))


def _ann(published):
    return server.AnnouncementIn(title=f"{TAG} notice", body="Hello families", published=published)


def _draft_then(run_steps):
    async def go():
        created = await server.create_announcement(_ann(False), ADMIN)
        out = await run_steps(created["id"])
        await asyncio.sleep(0.05)
        return out
    return run(go())


def test_publishing_a_draft_emails_it_once(sent):
    async def steps(aid):
        await server.update_announcement(aid, _ann(True), ADMIN)
        await server.update_announcement(aid, _ann(True), ADMIN)   # an edit does not email again
        return aid
    _draft_then(steps)
    assert len(sent) == 1


def test_publishing_again_after_unpublishing_does_not_email_twice(sent):
    async def steps(aid):
        await server.update_announcement(aid, _ann(True), ADMIN)
        await server.update_announcement(aid, _ann(False), ADMIN)
        await server.update_announcement(aid, _ann(True), ADMIN)
        return aid
    _draft_then(steps)
    assert len(sent) == 1


def test_a_draft_that_stays_a_draft_is_not_emailed(sent):
    async def steps(aid):
        await server.update_announcement(aid, _ann(False), ADMIN)
        return aid
    _draft_then(steps)
    assert sent == []
