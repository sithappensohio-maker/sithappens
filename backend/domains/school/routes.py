"""School-domain composition for the existing School API surface."""
from __future__ import annotations

from school_curriculum_routes import register_curriculum_import
from school_experience_feedback import register_school_experience_feedback
from school_practice_integrity import install_school_practice_integrity
from school_suite import register_school_suite


def register_school_routes(
    *,
    api,
    db,
    server_globals: dict,
    get_current_user,
    manage_school_dep,
    manage_training_content_dep,
    perms_for,
    school_events,
    persist_school_media,
    school_media_data_url,
    school_media_file_path,
    require_school_access,
    checkpoint_overall_scores,
    program_model,
    create_program,
    update_program,
    now_iso,
    homework_template_model,
    create_homework_template,
):
    """Register the School domain without mutating already-built routes."""
    # Practice repair still replaces two shared helper references because those
    # helpers are invoked by existing School logic, but production no longer
    # patches FastAPI route.endpoint/dependant.call objects.
    install_school_practice_integrity(
        db=db,
        server_globals=server_globals,
        patch_delete_routes=False,
    )

    register_curriculum_import(
        api=api,
        db=db,
        manage_dep=manage_training_content_dep,
        persist_school_media=persist_school_media,
        program_model=program_model,
        create_program=create_program,
        update_program=update_program,
        now_iso=now_iso,
        homework_template_model=homework_template_model,
        create_homework_template=create_homework_template,
    )

    _course_progress_fn = (
        server_globals.get("_school_course_progress") if hasattr(server_globals, "get")
        else getattr(server_globals, "_school_course_progress", None)
    )
    register_school_suite(
        api=api,
        db=db,
        course_progress=(lambda dp: _course_progress_fn(dp, dp.get("status") or "active")) if _course_progress_fn else None,
        get_current_user=get_current_user,
        manage_school_dep=manage_school_dep,
        perms_for=perms_for,
        school_events=school_events,
        persist_school_media=persist_school_media,
        school_media_data_url=school_media_data_url,
        school_media_file_path=school_media_file_path,
        require_school_access=require_school_access,
        checkpoint_overall_scores=checkpoint_overall_scores,
    )

    register_school_experience_feedback(
        api=api,
        db=db,
        get_current_user=get_current_user,
        manage_feedback_dep=manage_training_content_dep,
    )
