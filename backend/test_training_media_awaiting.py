"""The Today card "Video to review" counts only practice videos a trainer still has to review,
the same logs the Practice Review queue lists (audit #70). It also counted photos and videos
already reviewed or logged by an admin. Pure check."""
from domains.training.today import video_awaiting_review


def _log(**over):
    log = {"field_values": {"__video_id": "vid-1"}, "review_status": None, "logged_by_role": "trainer",
           "is_rest_day": False, "submission_status": "submitted"}
    log.update(over)
    return log


def test_an_unreviewed_video_counts():
    assert video_awaiting_review(_log()) is True


def test_a_photo_alone_is_not_a_video_to_review():
    assert video_awaiting_review(_log(field_values={"__photo": "data:image/png;base64,AAA"})) is False


def test_a_reviewed_or_admin_logged_or_rest_video_does_not_count():
    assert video_awaiting_review(_log(review_status="approved")) is False
    assert video_awaiting_review(_log(logged_by_role="admin")) is False
    assert video_awaiting_review(_log(is_rest_day=True)) is False
    assert video_awaiting_review(_log(submission_status="approved")) is False
