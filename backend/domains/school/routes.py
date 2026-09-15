"""School-domain composition for the existing School API surface."""
from __future__ import annotations

from fastapi import Depends

from school_curriculum_routes import register_curriculum_import
from school_experience_feedback import register_school_experience_feedback
from school_practice_integrity import install_school_practice_integrity
from school_suite import register_school_suite



async def build_practice_history(
    school_enrollment_id, limit, offset, user, *, db,
    school_enrollment_for_client, compute_daily_progress, streak_count,
    client_safe_homework, client_practice_summary,
):
    """Stage 4 — completed Practice for THIS enrollment only, newest first, in small
    pages with an exact total. Today's active_practice never carries completed rows
    (by design), so the Practice screen loads history on demand here instead of
    pulling the client's whole homework ledger. Same client-safe serializer +
    summary as the active rows; nothing new is persisted."""
    se, enrollment = await school_enrollment_for_client(school_enrollment_id, user)
    q = {"school_enrollment_id": se["id"], "status": "completed"}
    lim = max(1, min(int(limit or 5), 50))
    skip = max(0, int(offset or 0))
    total = await db.homework.count_documents(q)
    rows = await db.homework.find(q, {"_id": 0}).sort(
        [("completed_at", -1), ("created_at", -1)]).skip(skip).limit(lim).to_list(lim)
    items = []
    for hw in rows:
        if hw.get("daily_tracker"):
            _prog = compute_daily_progress(hw)
            hw["daily_progress"] = _prog
            hw["streak"] = streak_count(_prog)
            hw["total_days"] = len(_prog)
        safe = client_safe_homework(hw)
        safe.update(await client_practice_summary(
            hw, enrollment, current_hw_id=None, current_lesson_practiced=False, practice_required_now=False))
        items.append(safe)
    return {"items": items, "total": total, "offset": skip, "limit": lim}


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
    school_enrollment_for_client,
    compute_daily_progress,
    streak_count,
    client_safe_homework,
    client_practice_summary,
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


    @api.get("/portal/school/{school_enrollment_id}/practice-history")
    async def portal_school_practice_history(school_enrollment_id: str, limit: int = 5, offset: int = 0,
                                             user: dict = Depends(get_current_user)):
        return await build_practice_history(
            school_enrollment_id, limit, offset, user, db=db,
            school_enrollment_for_client=school_enrollment_for_client,
            compute_daily_progress=compute_daily_progress, streak_count=streak_count,
            client_safe_homework=client_safe_homework, client_practice_summary=client_practice_summary)

    # Same bridge the other extracted domains use: hand the callable back so the host
    # module re-exports it under its original name for the in-process suite.
    return {"portal_school_practice_history": portal_school_practice_history}
