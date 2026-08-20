"""Test helper — drive Online School the way a real client does.

Practice now opens only after the client has worked through the lesson's
instructional steps (Learn, Get Ready, Train, …). Tests that need a practised
lesson as *setup* should reach that state the same way a student does rather
than reaching around the gate, so this helper calls the REAL step-completion
endpoint followed by the REAL start-practice endpoint.

It deliberately does not touch the database directly and does not disable the
gate: if the gate broke, every test using this helper would fail, which is the
point. Tests that assert the gate itself should call
``server.portal_school_start_practice`` directly so nothing satisfies it first.
"""
import school_lesson_guide
import server


async def complete_instructional_steps(school_enrollment_id: str, lesson_id: str, user: dict):
    """Finish every instructional step this lesson actually presents.

    Returns the list of step keys completed (empty when the lesson does not
    present a guided sequence, in which case nothing gates Practice).
    """
    se, enrollment = await server._school_enrollment_for_client(school_enrollment_id, user)
    roadmap = await server._school_roadmap(enrollment, se["dog_id"])
    lesson, _module = await server._accessible_school_lesson(enrollment, roadmap, lesson_id)
    safe = server._client_safe_lesson(lesson)
    has_practice = bool(lesson.get("suggested_homework_template_ids"))
    has_quiz = bool(roadmap.get("module_quiz_available")) and bool(lesson.get("is_current"))
    if not school_lesson_guide.guide_is_active(safe, has_practice=has_practice, has_quiz=has_quiz):
        return []
    keys = school_lesson_guide.instructional_step_keys(
        safe, has_practice=has_practice, has_quiz=has_quiz)
    for key in keys:
        await server.portal_school_complete_lesson_step(
            school_enrollment_id, lesson_id, key, user)
    return keys


async def start_practice(school_enrollment_id: str, lesson_id: str, user: dict):
    """Complete the lesson material, then open Practice — a full client run."""
    await complete_instructional_steps(school_enrollment_id, lesson_id, user)
    return await server.portal_school_start_practice(school_enrollment_id, lesson_id, user)
