from pathlib import Path

import pytest
from pydantic import ValidationError

from school_experience_feedback import SchoolExperienceFeedbackIn, _experience_eligible, _feedback_id


HERE = Path(__file__).resolve().parent
SOURCE = (HERE / "school_experience_feedback.py").read_text(encoding="utf-8")
ENTRY = (HERE / "app_entry.py").read_text(encoding="utf-8")


def test_review_identity_is_client_dog_program_not_enrollment_attempt():
    assert _feedback_id("client-1", "dog-1", "program-1") == "school-experience:client-1:dog-1:program-1"
    assert "school_enrollment" not in _feedback_id("client-1", "dog-1", "program-1")


def test_feedback_is_only_for_online_or_hybrid_school_experience():
    assert _experience_eligible({"delivery_mode": "self_guided"}, {"delivery_channel": "online_school"}) is True
    assert _experience_eligible({"delivery_mode": "hybrid"}, {"delivery_channel": "hybrid_school"}) is True
    assert _experience_eligible({"delivery_mode": "trainer_led"}, {"delivery_channel": "in_person_school"}) is False
    assert "Experience feedback is available for Online School and hybrid courses" in SOURCE


def test_feedback_model_requires_core_answers_and_bounds_rating():
    valid = SchoolExperienceFeedbackIn(
        overall_rating=5,
        lesson_ease="easy",
        making_progress="yes",
        recommend="yes",
        testimonial_permission=True,
    )
    assert valid.overall_rating == 5
    assert valid.testimonial_permission is True
    with pytest.raises(ValidationError):
        SchoolExperienceFeedbackIn(overall_rating=6, lesson_ease="easy", making_progress="yes", recommend="yes")
    with pytest.raises(ValidationError):
        SchoolExperienceFeedbackIn(overall_rating=4, lesson_ease="mystery", making_progress="yes", recommend="yes")


def test_current_review_uses_unique_mongo_id_and_atomic_revision_increment():
    assert '{"_id": rid}' in SOURCE
    assert '"$inc": {"revision": 1}' in SOURCE
    assert 'return {"feedback": row, "saved": True, "updated": revision > 1}' in SOURCE


def test_every_save_preserves_a_revision_snapshot():
    assert "school_experience_feedback_history.insert_one" in SOURCE
    assert '"feedback_id": rid' in SOURCE
    assert '"snapshotted_at": now' in SOURCE


def test_testimonial_permission_is_explicit_not_inferred_from_positive_review():
    assert "testimonial_permission: bool = False" in SOURCE
    assert '"testimonial_permission": bool(body.testimonial_permission)' in SOURCE


def test_client_identity_comes_from_authenticated_enrollment_not_request_body():
    assert 'user.get("role") != "client"' in SOURCE
    assert '{"id": sid, "client_id": user.get("client_id")}' in SOURCE
    assert '"client_id": se.get("client_id")' in SOURCE
    assert '"dog_id": se.get("dog_id")' in SOURCE
    # No client_id/dog_id/program_id fields exist on the submitted review model.
    model_fields = SchoolExperienceFeedbackIn.model_fields
    assert "client_id" not in model_fields
    assert "dog_id" not in model_fields
    assert "program_id" not in model_fields


def test_admin_feedback_endpoint_uses_training_content_permission_gate():
    assert 'permission_factory("manage_training_content")' in SOURCE
    assert '@app.get("/api/admin/school/experience-feedback")' in SOURCE


def test_production_entrypoint_installs_feedback_extension():
    assert "from school_experience_feedback import install_school_experience_feedback" in ENTRY
    assert "install_school_experience_feedback(server_module=server, db=server.db)" in ENTRY
