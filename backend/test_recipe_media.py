"""Practice-recipe demo media: an uploaded picture on a recipe step or on the
Good Rep / Not This example reaches the client that owns a homework built
from that recipe, and nobody else."""
import uuid

import pytest

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_RECIPE_MEDIA"
PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="


def _admin():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin", "email": f"{TAG.lower()}@example.com"}


@pytest.fixture(scope="module", autouse=True)
def _cleanup():
    yield
    run(server.db.homework.delete_many({"title": {"$regex": f"^{TAG}"}}))
    run(server.db.homework_media.delete_many({"filename": {"$regex": f"^{TAG}"}}))


def test_recipe_models_accept_an_uploaded_media_id():
    step = server.PracticeCoachStepIn(title="Lure", instruction="Treat to the floor", media_id="m1")
    assert step.media_id == "m1" and step.media_url is None
    ex = server.PracticeCoachExampleIn(sequence=["Cue", "Down"], media_id="m2")
    assert ex.media_id == "m2"


def test_uploaded_step_picture_is_served_to_the_owning_client_only():
    up = run(server.upload_resource_file(server.ResourceFileUploadIn(data=PNG, filename=f"{TAG}-step.png"), _admin()))
    media_id = up["media_id"]
    assert up["kind"] == "image"

    owner_client = f"{TAG}-owner-{uuid.uuid4().hex[:6]}"
    run(server.db.homework.insert_one({
        "id": str(uuid.uuid4()), "title": f"{TAG} homework", "client_id": owner_client, "status": "assigned",
        "template_snapshot": {"sections": [], "practice_coach": {"enabled": True, "steps": [{"id": "s1", "title": "Lure", "instruction": "", "media_id": media_id}]}},
    }))
    owner = {"id": str(uuid.uuid4()), "role": "client", "client_id": owner_client, "name": "Owner"}
    got = run(server.get_resource_file(media_id, owner))
    assert got["id"] == media_id and got["data"].startswith("data:image/png")

    stranger = {"id": str(uuid.uuid4()), "role": "client", "client_id": f"{TAG}-stranger", "name": "Stranger"}
    with pytest.raises(server.HTTPException) as exc:
        run(server.get_resource_file(media_id, stranger))
    assert exc.value.status_code == 403


def test_good_rep_picture_counts_as_demo_media_and_is_reachable():
    up = run(server.upload_resource_file(server.ResourceFileUploadIn(data=PNG, filename=f"{TAG}-good.png"), _admin()))
    media_id = up["media_id"]
    owner_client = f"{TAG}-owner-{uuid.uuid4().hex[:6]}"
    run(server.db.homework.insert_one({
        "id": str(uuid.uuid4()), "title": f"{TAG} homework 2", "client_id": owner_client, "status": "assigned",
        "template_snapshot": {"sections": [], "practice_coach": {"enabled": True, "steps": [], "good_rep": {"sequence": ["Cue", "Down"], "media_id": media_id}}},
    }))
    owner = {"id": str(uuid.uuid4()), "role": "client", "client_id": owner_client, "name": "Owner"}
    assert run(server.get_resource_file(media_id, owner))["id"] == media_id
